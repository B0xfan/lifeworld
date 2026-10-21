#!/usr/bin/env node
/* Tests for "Create task" on selected lines (text to task, 2026-10-16): the task title taken from
 * a line, which lines a selection covers, and which project the tasks go to. Pure parts only; the
 * right-click entry, the project box and the marks were checked in a hidden test Obsidian.
 * Built file for behaviour (tests/lib/paths.js). */
'use strict';
const Module = require('module');
const { part } = require('./lib/paths');

class TFile {}
class TFolder {}
const fakeObsidian = { Plugin: class {}, ItemView: class {}, MarkdownView: class {}, Modal: class {}, PluginSettingTab: class {}, Setting: class {}, SuggestModal: class {}, TFile, TFolder, Notice: class {}, setIcon() {}, Platform: {}, Component: class {} };
const origLoad = Module._load;
Module._load = function (req, ...a) { return req === 'obsidian' ? fakeObsidian : origLoad.call(this, req, ...a); };
const L = part('a4-projects').logic;

let n = 0; let failed = 0;
function ok(c, name, extra) { n++; if (!c) { failed++; console.log(`FAIL ${name}${extra ? ' :: ' + extra : ''}`); } }
function eq(a, b, name) { const x = JSON.stringify(a); const y = JSON.stringify(b); ok(x === y, name, `got ${x} want ${y}`); }

// titles
const T = L.lineTaskTitle;
eq(T('- [ ] Call the plumber ^x1'), 'Call the plumber', 'title: bullet, checkbox and block id go (spec 3)');
eq(T('2. Book flights'), 'Book flights', 'title: number goes (spec 3)');
eq(T('Let Sam pick the paint (kitchen page).'), 'Let Sam pick the paint (kitchen page)', 'title: one trailing full stop goes');
eq(T('Wait for it...'), 'Wait for it...', 'title: an ellipsis stays');
eq(T('    * [x] Indented done step'), 'Indented done step', 'title: indent, star, ticked box');
eq(T('> - quoted item'), 'quoted item', 'title: quote mark');
eq(T('3) Third thing'), 'Third thing', 'title: 3) numbering');
eq(T('+ Add the "new" tag and label.'), 'Add the "new" tag and label', 'title: plus bullet, quotes kept');
eq(T('Ask [[Sam]] about #paint'), 'Ask [[Sam]] about #paint', 'title: links and tags inside the line stay');
eq(T('[a] not a task without a list mark'), '[a] not a task without a list mark', 'title: a bracket with no list mark in front stays');
eq(T('- [link] text'), '- [link] text'.slice(2), 'title: a longer bracket after the bullet stays');
eq(T('- [ ] '), '', 'title: an empty checkbox is nothing');
eq(T('   '), '', 'title: blank line is nothing');

// lines that cannot become tasks (round 2: headings skipped and counted, formatting-only lines skipped)
const K = L.lineTaskSkip;
eq(K('## 2. Book flights'), 'heading', 'skip: a heading');
eq(K('# Top'), 'heading', 'skip: a top heading');
eq(K('> ### Quoted heading'), 'heading', 'skip: a heading in a quote');
eq(K('#tag at the start'), null, 'skip: a tag is not a heading');
for (const l of ['', '   ', '-', '---', '***', '___', '- - -', '|---|---|', '| a | b |', '```', '```js', '~~~', '%%', '$$', '- [ ] ', '> ']) eq(K(l), 'format', `skip: formatting only ${JSON.stringify(l)}`);
for (const l of ['- Call the bank', 'Plain sentence', '1. Step one', '- [x] 3', '> - quoted item']) eq(K(l), null, `skip: a real line ${JSON.stringify(l)}`);

// where the mark goes (round 2: before a trailing block id)
eq(L.markAt('- [ ] Call the plumber ^x1'), '- [ ] Call the plumber'.length, 'mark: before the block id');
eq(L.markAt('- Call the plumber'), '- Call the plumber'.length, 'mark: end of line');
eq(L.markAt('Price is 2^10'), 'Price is 2^10'.length, 'mark: a caret inside a word is not a block id');

// finding the lines again (round 2)
const R = L.relocateLines;
eq(R(['a', 'b', 'c'], [{ line: 1, text: 'b' }]), [1], 'relocate: unchanged');
eq(R(['new', 'new2', 'a', 'b', 'c'], [{ line: 1, text: 'b' }, { line: 2, text: 'c' }]), [3, 4], 'relocate: lines added above');
eq(R(['x', 'x', 'y'], [{ line: 0, text: 'x' }, { line: 1, text: 'x' }]), [0, 1], 'relocate: two identical lines each find their own');
eq(R(['top', 'x', 'x'], [{ line: 0, text: 'x' }, { line: 1, text: 'x' }]), [1, 2], 'relocate: identical lines shifted down keep their order');
eq(R(['a', 'b changed'], [{ line: 1, text: 'b' }]), [-1], 'relocate: an edited line is not marked');
eq(L.TEXT_TASK_CONFIRM_OVER, 20, 'confirm: asks above 20 lines');

// selected lines
const pos = (line, ch) => ({ line, ch });
eq(L.selectedLines([{ anchor: pos(4, 3), head: pos(4, 3) }]), [4], 'lines: a bare cursor takes its line');
eq(L.selectedLines([{ anchor: pos(2, 5), head: pos(4, 9) }]), [2, 3, 4], 'lines: a selection over three lines');
eq(L.selectedLines([{ anchor: pos(4, 9), head: pos(2, 5) }]), [2, 3, 4], 'lines: selected upwards');
eq(L.selectedLines([{ anchor: pos(2, 0), head: pos(5, 0) }]), [2, 3, 4], 'lines: ending at the start of a line does not take it');
eq(L.selectedLines([{ anchor: pos(1, 0), head: pos(1, 4) }, { anchor: pos(1, 2), head: pos(3, 1) }]), [1, 2, 3], 'lines: overlapping selections, once each');

// project
const P = L.textTaskProject;
const A = 'Projects/Garden Shed.md'; const B = 'Projects/Boat Repair.md'; const C = 'Projects/Choir.md';
eq(P({ self: A, fmPaths: [B], linkPaths: [B, C] }), { project: A }, 'project: inside a project note, that one (spec 7)');
eq(P({ self: null, fmPaths: [A, A], linkPaths: [A, B, C] }), { project: A }, 'project: frontmatter names one (spec 8)');
eq(P({ self: null, fmPaths: [], linkPaths: [B, B] }), { project: B }, 'project: links to exactly one (spec 9)');
eq(P({ self: null, fmPaths: [], linkPaths: [B, A, A, B, A] }), { ask: true, candidates: [A, B], preselect: A }, 'project: several, most linked first (spec 10)');
eq(P({ self: null, fmPaths: [], linkPaths: [B, A] }), { ask: true, candidates: [B, A], preselect: B }, 'project: a tie goes to the first link');
eq(P({ self: null, fmPaths: [A, B], linkPaths: [] }), { ask: true, candidates: [A, B], preselect: A }, 'project: frontmatter names two, ask');
eq(P({ self: null, fmPaths: [], linkPaths: [] }), { ask: true, candidates: [], preselect: null }, 'project: none, no project preselected the first time (spec 11)');
eq(P({ self: null, fmPaths: [], linkPaths: [] }, C), { ask: true, candidates: [], preselect: C }, 'project: none, the last pick after one (spec 11)');
eq(P({ self: null, fmPaths: [], linkPaths: [A, B] }, C), { ask: true, candidates: [A, B], preselect: A }, 'project: several beat the last pick');

console.log(`${n - failed}/${n} passed`);
process.exit(failed ? 1 : 0);
