// The PDF manual (docs/LifeWorld-manual.pdf, opened by the "Open manual" button) says what README.md
// says: same words, same counts. Order is not compared, because scripts/build-manual.sh moves the
// TaskNotes credit to the end. A README edit without `sh scripts/build-manual.sh` fails here.
// Pictures are not compared. Skipped when pdftotext (poppler) is not installed.
const fs = require('fs');
const path = require('path');
const assert = require('assert');
const pdfText = require('./lib/pdf-text');
const ROOT = path.join(__dirname, '..');

const pdf = pdfText(path.join(ROOT, 'docs', 'LifeWorld-manual.pdf'));
if (pdf === null) { console.log('manual PDF check: skipped (pdftotext not installed)'); process.exit(0); }
// Hyphens dropped on both sides: pdftotext joins "Open-" and "Meteo" across a line break.
const words = (t) => t.replace(/-/g, '').toLowerCase().split(/[^\p{L}\p{N}]+/u).filter(Boolean);
const count = (list) => list.reduce((m, w) => m.set(w, (m.get(w) || 0) + 1), new Map());
const readme = fs.readFileSync(path.join(ROOT, 'README.md'), 'utf8')
  .replace(/^!\[.*$/gm, '') // pictures: the PDF shows them, without their alt text
  .replace(/\]\([^)]*\)/g, ']') // link targets are not printed
  .replace(/<[^>]+>/g, '');
const want = count([...words(readme), 'user', 'manual']); // the PDF's subtitle
const got = count(words(pdf.replace(/^\s*\d+\s*$/gm, ''))); // page numbers
const diff = [...new Set([...want.keys(), ...got.keys()])]
  .filter((w) => want.get(w) !== got.get(w)).map((w) => `"${w}": README ${want.get(w) || 0}, PDF ${got.get(w) || 0}`);
assert.deepStrictEqual(diff, [], `the PDF manual is out of date; run sh scripts/build-manual.sh:\n${diff.join('\n')}`);
console.log(`manual PDF check: OK (${[...got.values()].reduce((a, b) => a + b, 0)} words match README.md)`);
