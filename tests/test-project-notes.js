#!/usr/bin/env node
/* Self-check for project notes (0.1.4, mockup Option B): a note typed in the add box's Note mode
 * is added as the last entry under the project note's "## Notes" (the section made at the end when
 * missing) and every other character stays the same; the Notes card reads the entries newest first.
 * Set LW_REAL_NOTE=<path to a copy of a real project note> to run the same checks on it too.
 * The menu, the card and the clicks need a real Obsidian. */
'use strict';
const fs = require('fs');
const Module = require('module');
const assert = require('assert');
const { part } = require('./lib/paths');
const fake = { Plugin: class {}, ItemView: class {}, MarkdownView: class {}, Modal: class {}, SuggestModal: class {}, PluginSettingTab: class {}, Setting: class {}, TFile: class {}, TFolder: class {}, Notice: class {}, setIcon() {}, Platform: {}, Component: class {} };
const load = Module._load;
Module._load = function (req, ...a) { return req === 'obsidian' ? fake : load.call(this, req, ...a); };
const L = part('a4-projects').logic;

const DAY = '2026-10-17';
const NOTE = 'Made new mock-ups, waiting for [[Sam]] to look at them.';
const ENTRY = `### [[${DAY}]]\n${NOTE}`;

// The only change is inserted text: before + added + after === the result, before + after === the original.
function onlyAdds(before, after, name) {
  let i = 0; while (i < before.length && before[i] === after[i]) i++;
  const tail = before.slice(i);
  assert.ok(after.endsWith(tail), `${name}: text after the insert is unchanged`);
  const added = after.slice(i, after.length - tail.length);
  assert.ok(added.includes(ENTRY), `${name}: the entry is what was added`);
  return added;
}

const FM = '---\ntype: project\nstatus: active\n---\n\n# P\n\n';
// Section at the end of the note.
let t = `${FM}## Notes\n\n### [[2026-10-01]] — First\n\nBody.\n`;
let out = L.appendProjectNote(t, DAY, NOTE);
assert.strictEqual(out, `${t}\n${ENTRY}\n`);
onlyAdds(t, out, 'end');
assert.deepStrictEqual(L.projectNotes(out).map((n) => n.day), [DAY, '2026-10-01']);
assert.strictEqual(L.projectNotes(out)[0].text, NOTE, 'a note with no heading title shows its text');
assert.strictEqual(L.projectNotes(out)[1].text, 'First', 'the heading title, without the date and dash');

// Section followed by another section: the entry goes before it, the next section is untouched.
t = `${FM}## Notes\n\n### [[2026-10-01]]\nOld.\n\n\n## Links\n\n- [[A]]\n`;
out = L.appendProjectNote(t, DAY, NOTE);
assert.strictEqual(out, `${FM}## Notes\n\n### [[2026-10-01]]\nOld.\n\n${ENTRY}\n\n\n## Links\n\n- [[A]]\n`);
onlyAdds(t, out, 'middle');

// No section: added at the end; a "## Notes" inside a code block or the frontmatter does not count.
t = `---\nx: "## Notes"\n---\n# P\n\n\`\`\`\n## Notes\n\`\`\`\n## Tasks\n![[t.base]]`;
out = L.appendProjectNote(t, DAY, NOTE);
assert.strictEqual(out, `${t}\n\n## Notes\n\n${ENTRY}\n`);
onlyAdds(t, out, 'missing');
assert.strictEqual(L.projectNotes(t).length, 0);
assert.strictEqual(L.appendProjectNote('', DAY, 'x'), `## Notes\n\n### [[${DAY}]]\nx\n`, 'empty note');

// Empty section right before the next one.
t = `${FM}## Notes\n## Next\n`;
assert.strictEqual(L.appendProjectNote(t, DAY, NOTE), `${FM}## Notes\n\n${ENTRY}\n## Next\n`);

// Typed text stays as typed; a leading # is escaped so it can't become a heading and close the section.
assert.ok(L.appendProjectNote(`${FM}## Notes\n`, DAY, '# 1 thing').endsWith(`### [[${DAY}]]\n\\# 1 thing\n`));
assert.ok(L.appendProjectNote(`${FM}## Notes\n`, DAY, '#beach day').endsWith(`### [[${DAY}]]\n#beach day\n`));

// A note starting with a code fence, comment or math opener is escaped too, so the next note still
// lands under Notes and the card reads every entry back as typed (no "\\" shown).
for (const typed of ['```js', '~~~', '%% hidden', '<!-- x', '$$ x^2', '# 1 thing']) {
  let n = L.appendProjectNote(`${FM}## Notes\n## Links\n`, DAY, typed);
  assert.ok(n.includes(`### [[${DAY}]]\n\\${typed}\n## Links`), `${typed}: escaped, inside Notes`);
  n = L.appendProjectNote(n, '2026-10-18', 'next');
  assert.ok(/next\n## Links\n$/.test(n), `${typed}: the next note still goes under Notes`);
  assert.deepStrictEqual(L.projectNotes(n), [{ day: '2026-10-18', text: 'next' }, { day: DAY, text: typed }], `${typed}: read back`);
}

// Reading: same-day entries latest-added first, undated last, #### stays inside its entry, ## ends the section.
t = `## Notes\n### [[2026-10-05]] A\n### Undated one\n### [[2026-10-09]]\n\nLine one\nline two\n\nLater para\n#### sub\n### [[2026-10-09]] B\n## Other\n### [[2026-12-01]] not a note\n`;
assert.deepStrictEqual(L.projectNotes(t), [
  { day: '2026-10-09', text: 'B' }, { day: '2026-10-09', text: 'Line one line two' },
  { day: '2026-10-05', text: 'A' }, { day: '', text: 'Undated one' },
]);

// A copy of a real project note, when given.
const real = process.env.LW_REAL_NOTE;
if (real) {
  const before = fs.readFileSync(real, 'utf8');
  const n0 = L.projectNotes(before);
  const after = L.appendProjectNote(before, DAY, NOTE);
  const added = onlyAdds(before, after, 'real note');
  assert.strictEqual(added, `\n${ENTRY}\n`, 'real note: only the entry lines were added');
  const n1 = L.projectNotes(after);
  assert.strictEqual(n1.length, n0.length + 1);
  assert.deepStrictEqual(n1[0], { day: DAY, text: NOTE });
  assert.deepStrictEqual(n1.slice(1), n0, 'real note: the existing entries read the same');
  fs.writeFileSync(real, after); // the scratch copy, so the diff can be looked at
  console.log(`real note: ${n0.length} entries before, newest ${n0[0] && n0[0].day}; added ${JSON.stringify(added)}`);
}
console.log('project notes: ok');
