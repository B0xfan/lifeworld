#!/usr/bin/env node
/* Typed bullets (Tana-style bullets job, 2026-11-10): the rules in src/bullets/logic.js.
 * No Obsidian. `node tests/test-bullets.js` */
'use strict';
const assert = require('assert');
const { fromSrc } = require('./lib/paths');
const L = fromSrc('bullets/logic');

const types = L.starterTypes();
const person = types[0]; const decision = types[1];

// Criterion 1: starter types; a saved list is cleaned, never holds "task", names unique.
assert.deepStrictEqual(types.map((t) => t.name), ['Person', 'Decision']);
assert.strictEqual(person.where, 'folder');
assert.deepStrictEqual(person.props, { type: 'person' });
const cleaned = L.cleanTypes([{ name: 'task' }, { name: '#Place', color: 'nope', aliases: ['beach', 'Place', 'task'], fields: [{ name: 'Town', kind: 'odd' }, { name: 'bad::name' }] }, { name: 'place' }, null, { name: '12' }]);
assert.deepStrictEqual(cleaned, [{ name: 'Place', color: 'blue', aliases: ['beach'], fields: [{ name: 'Town', kind: 'text' }], where: 'note' }]);
assert.deepStrictEqual(L.cleanTypes(undefined).map((t) => t.name), ['Person', 'Decision']);
assert.deepStrictEqual(L.cleanTypes([]), [], 'an empty saved list stays empty (the user removed both)');

// Criterion 10: the # menu. Prefix matches first, then other names, then did-you-mean, then Create.
const menu = (q) => L.menuFor(types, q).map((c) => (c.kind === 'create' ? `+${c.name}` : `${c.type === 'task' ? 'task' : c.type.name}${c.alias ? `(${c.alias})` : ''}${c.near ? '?' : ''}`));
assert.deepStrictEqual(menu(''), ['task', 'Person', 'Decision']);
assert.deepStrictEqual(menu('d'), ['Decision', '+d']);
assert.deepStrictEqual(menu('contact'), ['Person(contact)'], '#contact picks Person, no Create');
assert.deepStrictEqual(menu('Contact'), ['Person(contact)']);
assert.deepStrictEqual(menu('peple'), ['Person?', '+peple'], '#peple: did you mean Person');
assert.deepStrictEqual(menu('persons'), ['Person?', '+persons']);
assert.deepStrictEqual(menu('PERSON'), ['Person']);
assert.deepStrictEqual(menu('place'), ['+place']);
assert.deepStrictEqual(menu('tsak'), ['task?', '+tsak']);
assert.strictEqual(L.typeFor(types, 'people'), person);
assert.strictEqual(L.typeFor(types, 'TASK'), 'task');
assert.strictEqual(L.typeFor(types, 'nope'), null);

// Criterion 10.3: a folder another type already makes notes in.
const withFolder = L.cleanTypes([{ ...person, folder: 'Contacts/People/' }, decision]);
assert.strictEqual(L.folderOwner(withFolder, 'contacts/people').name, 'Person');
assert.strictEqual(L.folderOwner(withFolder, 'Contacts/People', 'Person'), null, 'not itself');
assert.strictEqual(L.folderOwner(withFolder, 'Places'), null);

// Lines: the tag at the end of a bullet, field lines, the fields under a bullet.
assert.deepStrictEqual(L.tagAtEnd('- Favourites page: take the heart off #Decision'), { tag: 'Decision', at: 38, end: 47, text: 'Favourites page: take the heart off', depth: 0, indent: '' });
assert.strictEqual(L.tagAtEnd('\t- [[Add a filter]] #task').tag, 'task');
assert.strictEqual(L.tagAtEnd('- #Decision in the middle of text'), null, 'only the last word');
assert.strictEqual(L.tagAtEnd('Not a list #Decision'), null);
assert.strictEqual(L.tagAtEnd('[[Call Mara]] #task').tag, 'task', 'a plain #task line (criterion 13) gets the task look');
assert.strictEqual(L.tagAtEnd('Plain words #task').text, 'Plain words');
assert.strictEqual(L.tagAtEnd('- Issue #123'), null, 'all digits is not a tag');
assert.strictEqual(L.tagAtEnd('- [ ] call #Decision').text, 'call');
const fl = L.fieldLine('\t- Decided by:: Mara');
assert.deepStrictEqual(fl, { name: 'Decided by', value: 'Mara', nameAt: 3, valueAt: 16, depth: 4 });
assert.strictEqual('\t- Decided by:: Mara'.slice(fl.nameAt, fl.nameAt + 10), 'Decided by');
assert.deepStrictEqual(L.fieldLine('    - Final:: '), { name: 'Final', value: '', nameAt: 6, valueAt: 14, depth: 4 });
assert.strictEqual(L.fieldLine('- see https://x.y'), null);
assert.strictEqual(L.fieldLine('- a:b:: c'), null, 'a field name has no colon');
const note = ['- Shop pages', '\t- Favourites #Decision', '\t\t- Decided by:: Mara', '\t\t- Note without field', '\t\t- Final:: not yet', '\t- Next sibling', '\t\t- Final:: other'];
assert.deepStrictEqual(L.fieldsUnder(note, 1).map((f) => [f.line, f.name, f.value]), [[2, 'Decided by', 'Mara'], [4, 'Final', 'not yet']]);
// Criterion 2: inserted field lines, existing ones not duplicated, defaults kept.
assert.deepStrictEqual(L.fieldLinesFor(decision, '\t', []), ['\t\t- Decided by:: ', '\t\t- Final:: ']);
assert.deepStrictEqual(L.fieldLinesFor(decision, '  ', ['final']), ['      - Decided by:: ']);
assert.deepStrictEqual(L.fieldLinesFor({ ...decision, fields: [{ name: 'Final', kind: 'choice', options: ['a'], default: 'a' }] }, '', []), ['\t- Final:: a']);

// Criterion 5: bullets in a note, the query, filters and sort.
const text = ['# Call', '- Fav #Decision', '\t- Decided by:: Mara', '\t- Final:: not yet', '```', '- Hidden #Decision', '```', '- Sale #decision', '\t- Final:: yes', '- Plain'].join('\n');
assert.deepStrictEqual(L.bulletsIn(text, decision), [
  { line: 1, text: 'Fav', fields: { 'decided by': 'Mara', final: 'not yet' } },
  { line: 7, text: 'Sale', fields: { final: 'yes' } },
]);
const q = L.parseQuery('type: Decision\nwhere: Final is not yet\nproject: this one\nsort: Decided by desc', types);
assert.strictEqual(q.type, decision);
assert.deepStrictEqual(q.where, [{ field: 'Final', not: false, value: 'not yet' }]);
assert.strictEqual(q.project, true);
assert.deepStrictEqual(q.sort, { field: 'Decided by', desc: true });
assert.deepStrictEqual(L.parseQuery('type: Decison', types), { error: 'There is no type called Decison. Your types are task, Person and Decision.' });
assert.match(L.parseQuery('', types).error, /Say which type/);
assert.match(L.parseQuery('type: task', types).error, /own lists/);
assert.match(L.parseQuery('type: Decision\nwhere: Colour is red', types).error, /no field called Colour/);
assert.match(L.parseQuery('type: Decision\nwhere Final', types).error, /not understood/);
assert.match(L.parseQuery('type: Decision\nfoo: bar', types).error, /not something the list knows/);
assert.strictEqual(L.parseQuery('type: contact', types).type, person, 'other names work here too');
const rows = [{ text: 'A', note: 'n', fields: { final: 'not yet', 'decided by': '[[People/Mara|Mara]]' } }, { text: 'B', note: 'n', fields: { final: 'yes' } }, { text: 'C', note: 'n', fields: {} }];
assert.deepStrictEqual(rows.filter((r) => L.rowMatches(r, [{ field: 'Final', not: false, value: 'Not Yet' }])).map((r) => r.text), ['A']);
assert.deepStrictEqual(rows.filter((r) => L.rowMatches(r, [{ field: 'Final', not: true, value: 'empty' }])).map((r) => r.text), ['A', 'B']);
assert.deepStrictEqual(rows.filter((r) => L.rowMatches(r, [{ field: 'Decided by', not: false, value: 'mara' }])).map((r) => r.text), ['A']);
assert.deepStrictEqual(L.sortRows(rows, { field: 'Final', desc: false }).map((r) => r.text), ['A', 'B', 'C']);
assert.deepStrictEqual(L.sortRows(rows, { field: 'Final', desc: true }).map((r) => r.text), ['B', 'A', 'C'], 'empty last both ways');

// Criterion 10a: initials.
assert.strictEqual(L.initials('Mara'), 'MA');
assert.strictEqual(L.initials('Ada Lovelace'), 'AL');
assert.strictEqual(L.initials('Alexa Sanchez Gomez'), 'AG');
assert.strictEqual(L.initials('  '), '?');
assert.strictEqual(L.propKey('Decided by'), 'decided_by');
assert.strictEqual(L.plain('[[A/B|C]] and [[D/E]]'), 'C and E');

// Review r1: a grandchild's field line belongs to its own bullet, not the one above.
const nested = ['- Pick vendor #Decision', '\t- Option A #Decision', '\t\t- Final:: yes', '\t- Final:: not yet'];
assert.deepStrictEqual(L.fieldsUnder(nested, 0).map((f) => [f.line, f.value]), [[3, 'not yet']]);
assert.deepStrictEqual(L.fieldsUnder(nested, 1).map((f) => [f.line, f.value]), [[2, 'yes']]);
// Review r1: a ~~~ fence is not closed by a ``` line inside it.
const fenced = ['~~~', '```', '- Hidden #Decision', '~~~', '- Shown #Decision'].join('\n');
assert.deepStrictEqual(L.bulletsIn(fenced, L.starterTypes()[1]).map((b) => b.text), ['Shown']);
assert.strictEqual(L.fenceAfter('', '````js'), '````');
assert.strictEqual(L.fenceAfter('````', '```'), '````');
assert.strictEqual(L.fenceAfter('````', '`````'), '');
// Criterion 13: #task on any line.
assert.deepStrictEqual(L.anyLine('Call when [[Mara Lopez]] is free'), { indent: '', depth: 0, text: 'Call when [[Mara Lopez]] is free', textAt: 0 });
assert.strictEqual(L.anyLine('  plain words').textAt, 2);
assert.strictEqual(L.anyLine('- [ ] boxed').textAt, 6, 'a list line keeps its marker');
assert.strictEqual(L.plain('Call when [[People/Mara Lopez]] is free'), 'Call when Mara Lopez is free');
// Criterion 12: @ finds people by any word of the name or an alias, names starting with it first.
const people = [{ name: 'Mara Lopez', aliases: [] }, { name: 'Ada Lovelace', aliases: ['Countess'] }, { name: 'Lopez Bakery', aliases: [] }];
assert.deepStrictEqual(L.peopleFor(people, 'lo').map((p) => p.name), ['Lopez Bakery', 'Ada Lovelace', 'Mara Lopez']);
assert.deepStrictEqual(L.peopleFor(people, 'COUNT').map((p) => p.name), ['Ada Lovelace']);
assert.deepStrictEqual(L.peopleFor(people, 'zz'), []);
assert.strictEqual(L.peopleFor(people, '').length, 3);
// Review r2: "```js" inside an open block does not close it.
assert.strictEqual(L.fenceAfter('```', '```js'), '```');
assert.strictEqual(L.fenceAfter('```', '  ```  '), '');
// Criterion 14: the Person folder is found on its own. A common layout: Contacts/People holds the people
// (type: person), Contacts/Companies the companies; "Contacts" matches an alias too but is not the answer.
const vault = [
  { path: 'Contacts/People/Mara Lopez.md', fm: { type: 'person' } }, { path: 'Contacts/People/Ana.md', fm: { type: 'Person' } },
  { path: 'Contacts/People/Old.md' }, { path: 'Contacts/Companies/Acme.md', fm: { type: 'company' } },
  { path: 'Contacts/Index.md' }, { path: 'Inbox/Bob.md', fm: { type: 'person' } }, { path: 'Top.md', fm: { type: 'person' } },
];
assert.strictEqual(L.guessFolder(person, vault), 'Contacts/People', 'most notes with type: person');
assert.strictEqual(L.guessFolder(person, vault.map((x) => ({ path: x.path }))), 'Contacts/People', 'no properties: the fuller matching name');
assert.strictEqual(L.guessFolder(person, [{ path: 'Work/Persons/A.md' }]), 'Work/Persons', 'plural of the name');
assert.strictEqual(L.guessFolder(person, [{ path: 'Notes/A.md', fm: { type: 'company' } }]), '', 'nothing found');
assert.strictEqual(L.guessFolder(decision, vault), '', 'Decision has no props and no matching folder');
assert.strictEqual(L.guessFolder(person, [{ path: 'C/People/Family/A.md', fm: { type: 'person' } }, { path: 'C/People/Family/B.md', fm: { type: 'person' } }, { path: 'C/People/Work/D.md', fm: { type: 'person' } }]), 'C/People', 'subfolders: the folder they share');
assert.strictEqual(L.guessFolder(person, [{ path: 'P/A.md', fm: { type: ['client', 'person'] } }]), 'P', 'a list property holding person');
assert.strictEqual(L.guessFolder({ ...person, props: { status: '' } }, [{ path: 'Journal/A.md' }, { path: 'Journal/B.md' }]), '', 'an empty starting value matches nothing');
console.log('test-bullets: all passed');
